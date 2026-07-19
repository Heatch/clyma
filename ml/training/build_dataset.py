import json
import os
import random
import urllib.request
from datetime import datetime, timedelta, timezone

# SFT format-prior targets: uniform buckets across [0.05, 0.95] in 0.05 steps.
# This teaches the model "any float in [0,1] is valid" without biasing toward 0.50.
SFT_BUCKETS = [f"{v:.2f}" for v in [i * 0.05 for i in range(1, 20)]]

# Climate-related keywords for domain filtering.
CLIMATE_KEYWORDS = [
    "climate", "weather", "hurricane", "temperature", "carbon", "emission",
    "environment", "rain", "flood", "storm", "wildfire", "drought",
    "sea level", "earthquake", "tornado", "cyclone", "el nino", "la nina",
    "glacier", "arctic", "antarctic", "ozone", "methane", "deforestation",
    "heatwave", "heat wave", "typhoon", "monsoon", "pollution", "renewable",
    "solar", "wind energy", "fossil fuel", "greenhouse", "warming",
    "natural disaster", "fire", "energy", "oil", "gas price", "electric",
    "nuclear", "water", "air quality", "coral", "ice", "snow", "volcano",
    "tsunami", "famine", "crop", "agriculture", "forest", "ecology",
    "biodiversity", "species", "extinction", "ocean", "coastal", "erosion",
    "sustainability", "epa", "paris agreement", "cop2", "ipcc",
]

# Minimum number of climate markets required to proceed.
MIN_CLIMATE_MARKETS = 100


def fetch_polymarket_events(limit=100, offset=0):
    url = f"https://gamma-api.polymarket.com/events?closed=true&limit={limit}&offset={offset}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    events = []
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            events = json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching from Polymarket offset {offset}: {e}")
    return events


def build_dataset(output_dir="dataset"):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    full_output_dir = os.path.join(script_dir, output_dir)
    os.makedirs(full_output_dir, exist_ok=True)

    print("Fetching historical resolved markets from Polymarket Gamma API...")
    print("Filtering strictly to climate/weather/environment domain.\n")

    events = []
    # Cast a wide net — climate markets are sparse across Polymarket's full history.
    for offset in range(0, 15000, 100):
        print(f"  Fetching page at offset {offset}...")
        batch = fetch_polymarket_events(limit=100, offset=offset)
        if not batch:
            print(f"  No more results at offset {offset}, stopping pagination.")
            break
        events.extend(batch)

    print(f"\nTotal raw events fetched: {len(events)}")

    # Cutoff: drop markets that resolved within the last 7 days (data leakage guard).
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    dataset = []
    skipped_no_date = 0

    for event in events:
        description = event.get("description", "No context provided.")
        category = event.get("category", "General")
        title = event.get("title", "")

        # Domain filter: only keep climate-related events.
        search_text = (description + " " + category + " " + title).lower()
        if not any(k in search_text for k in CLIMATE_KEYWORDS):
            continue

        markets = event.get("markets", [])
        for m in markets:
            if not m.get("closed"):
                continue

            outcomes = m.get("outcomes", "[]")
            outcome_prices = m.get("outcomePrices", "[]")

            try:
                outcomes_list = json.loads(outcomes)
                prices_list = json.loads(outcome_prices)

                if len(outcomes_list) == 2 and "Yes" in outcomes_list and "No" in outcomes_list:
                    yes_idx = outcomes_list.index("Yes")
                    yes_price = float(prices_list[yes_idx])

                    # Resolved outcome: 1.0 (Yes won) or 0.0 (No won).
                    resolved_outcome = 1.0 if yes_price > 0.5 else 0.0

                    # Temporal key: prefer endDate, fall back to createdAt, then skip.
                    end_date = m.get("endDate", "") or m.get("createdAt", "")
                    if not end_date:
                        skipped_no_date += 1
                        continue

                    # Drop markets resolved within the last 7 days.
                    if end_date > cutoff_date:
                        continue

                    record = {
                        "input": json.dumps({
                            "question": m.get("question", ""),
                            "region": "Global",
                            "category": category,
                            "resolution_rules": description
                        }),
                        # SFT format-prior: random uniform bucket, NOT the closing price.
                        # The closing price on resolved markets is ~0.99 or ~0.01 (the answer key).
                        # GRPO will learn the actual calibrated probabilities from the Brier reward.
                        "output": random.choice(SFT_BUCKETS),
                        "metadata": {
                            "resolved_outcome": str(resolved_outcome),
                            "endDate": end_date
                        }
                    }
                    dataset.append(record)
            except Exception:
                continue

    if skipped_no_date > 0:
        print(f"Skipped {skipped_no_date} markets with no parseable date.")

    # De-duplicate by question text.
    seen = set()
    unique_dataset = []
    for d in dataset:
        q = json.loads(d["input"])["question"]
        if q not in seen:
            seen.add(q)
            unique_dataset.append(d)

    print(f"\nExtracted {len(unique_dataset)} unique climate binary markets.")

    # Hard assertion: abort if we don't have enough climate data.
    assert len(unique_dataset) >= MIN_CLIMATE_MARKETS, (
        f"CRITICAL: Only found {len(unique_dataset)} climate markets (need >= {MIN_CLIMATE_MARKETS}). "
        f"Consider supplementing with Kalshi API: https://trading-api.kalshi.com/v1/"
    )

    # Temporal split: sort chronologically, most recent 20% becomes eval.
    unique_dataset.sort(key=lambda r: r["metadata"].get("endDate", ""))
    split_idx = int(len(unique_dataset) * 0.8)
    train_data = unique_dataset[:split_idx]
    eval_data = unique_dataset[split_idx:]

    # Temporal hygiene assertion.
    if train_data and eval_data:
        train_max = train_data[-1]["metadata"].get("endDate", "")
        eval_min = eval_data[0]["metadata"].get("endDate", "")
        print(f"\n--- Temporal Hygiene Check ---")
        print(f"  Train endDate range: {train_data[0]['metadata'].get('endDate', '?')} -> {train_max}")
        print(f"  Eval  endDate range: {eval_min} -> {eval_data[-1]['metadata'].get('endDate', '?')}")
        assert train_max <= eval_min, (
            f"TEMPORAL SPLIT CONTAMINATED: train_max={train_max} >= eval_min={eval_min}"
        )
        print(f"  Assertion passed: train_max <= eval_min [OK]")

    # Verify no question overlap between train and eval.
    train_questions = {json.loads(d["input"])["question"] for d in train_data}
    eval_questions = {json.loads(d["input"])["question"] for d in eval_data}
    overlap = train_questions & eval_questions
    assert len(overlap) == 0, f"Question overlap between train and eval: {overlap}"
    print(f"  No question overlap between train and eval [OK]")

    # Report positive-class base rates.
    train_pos = sum(1 for d in train_data if d["metadata"]["resolved_outcome"] == "1.0")
    eval_pos = sum(1 for d in eval_data if d["metadata"]["resolved_outcome"] == "1.0")
    print(f"\n--- Distribution ---")
    print(f"  Train: {len(train_data)} samples ({train_pos} positive, {len(train_data) - train_pos} negative, base rate {train_pos/max(len(train_data),1):.2%})")
    print(f"  Eval:  {len(eval_data)} samples ({eval_pos} positive, {len(eval_data) - eval_pos} negative, base rate {eval_pos/max(len(eval_data),1):.2%})")

    # Shuffle train data so SFT epochs see varied ordering.
    random.shuffle(train_data)

    train_path = os.path.join(full_output_dir, "train.jsonl")
    eval_path = os.path.join(full_output_dir, "eval.jsonl")

    with open(train_path, "w", encoding="utf-8") as f:
        for r in train_data:
            f.write(json.dumps(r) + "\n")

    with open(eval_path, "w", encoding="utf-8") as f:
        for r in eval_data:
            f.write(json.dumps(r) + "\n")

    print(f"\nWrote {len(train_data)} train samples to {train_path}")
    print(f"Wrote {len(eval_data)} eval samples to {eval_path}")


if __name__ == "__main__":
    build_dataset()
"""Rewritten for V4: climate-only domain filter, uniform-random SFT format-prior targets,
temporal split with hygiene assertions, and >=100-market volume guard."""
