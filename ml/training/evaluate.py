"""
Evaluation harness for the Climate Market Forecasting model (V4).

Reports: Inverted Brier Score, ECE (10 bins), Mean Predicted Probability,
and Format-Fail Rate. These four metrics together expose the always-0.50
pathology and distinguish real learning from format-only memorization.
"""

import json
import os
import re
from pathlib import Path

from openai import OpenAI

# Load API key from environment variable (not a hardcoded Desktop path).
api_key = os.environ.get("FREESOLO_API_KEY", "")
if not api_key:
    # Fallback for local dev — read from the user's key file.
    try:
        with open(r"C:\Users\lawre\OneDrive\Desktop\key.txt", "r") as f:
            api_key = f.read().strip()
    except Exception:
        api_key = "dummy"

client = OpenAI(
    base_url="https://clado-ai--freesolo-lora-serving.modal.run/v1",
    api_key=api_key
)

# The adapter ID to evaluate. Set via env var so new training runs
# don't require code changes.
ADAPTER_ID = os.environ.get("GRPO_ADAPTER_ID", "")


def generate_response(messages: list) -> str:
    try:
        response = client.chat.completions.create(
            model=ADAPTER_ID,
            messages=messages,
            max_tokens=10,
            temperature=0.0
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"API Error: {e}")
        return "ERROR"


def compute_ece(predictions, truths, n_bins=10):
    """Expected Calibration Error with n_bins equal-width bins."""
    bin_boundaries = [i / n_bins for i in range(n_bins + 1)]
    bin_sums = [0.0] * n_bins
    bin_true_sums = [0.0] * n_bins
    bin_counts = [0] * n_bins

    for p, y in zip(predictions, truths):
        bin_idx = min(int(p * n_bins), n_bins - 1)
        bin_sums[bin_idx] += p
        bin_true_sums[bin_idx] += y
        bin_counts[bin_idx] += 1

    ece = 0.0
    total = len(predictions)
    for i in range(n_bins):
        if bin_counts[i] == 0:
            continue
        avg_confidence = bin_sums[i] / bin_counts[i]
        avg_accuracy = bin_true_sums[i] / bin_counts[i]
        ece += (bin_counts[i] / total) * abs(avg_confidence - avg_accuracy)

    return ece


def evaluate_model():
    if not ADAPTER_ID:
        print("ERROR: No adapter ID set. Set GRPO_ADAPTER_ID env var or pass it as an argument.")
        print("  Example: set GRPO_ADAPTER_ID=flash-XXXXXXXXXX-YYYYYYYY")
        return

    dataset_path = Path(__file__).parent / "dataset" / "eval.jsonl"

    if not dataset_path.exists():
        print(f"Eval dataset not found at {dataset_path}")
        return

    from environment import ClimateMarketEnvironment
    env = ClimateMarketEnvironment(split="eval")

    total_score = 0.0
    count = 0
    format_fails = 0
    predictions = []
    truths = []

    # Count total lines first for progress reporting.
    with open(dataset_path, "r", encoding="utf-8") as f:
        total_lines = sum(1 for line in f if line.strip())

    print(f"Running evaluation on {total_lines} held-out climate markets...")
    print(f"Adapter: {ADAPTER_ID}")
    print(f"{'-' * 90}")

    with open(dataset_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue

            sample = json.loads(line)

            from freesolo.datasets import TaskExample
            example = TaskExample(input=sample["input"], output=sample["output"], record=sample)
            messages = env.build_prompt_messages(example, example.input)

            # Generate prediction from the deployed model.
            prediction_str = generate_response(messages)

            # Check for format failure.
            match = re.search(r"^(0\.\d{2}|1\.00)$", str(prediction_str).strip())
            if not match:
                format_fails += 1

            # Score using the environment (Soft Brier for eval).
            try:
                result = env.score_response(example, prediction_str)
                true_outcome = example.record['metadata'].get('resolved_outcome', '?')
                question_preview = json.loads(sample["input"]).get("question", "")[:50]

                print(f"  [{count+1:3d}/{total_lines}] Pred: {prediction_str:5s} | True: {true_outcome:3s} | Score: {result.score:.4f} | {question_preview}...")

                total_score += result.score
                count += 1

                # Track valid predictions for ECE calculation.
                if match:
                    predictions.append(float(match.group(1)))
                    truths.append(float(true_outcome))

            except Exception as e:
                print(f"  Error scoring sample: {e}")

    if count == 0:
        print("No samples evaluated.")
        return

    avg_score = total_score / count
    format_fail_rate = format_fails / count
    mean_pred_prob = sum(predictions) / len(predictions) if predictions else float('nan')
    ece = compute_ece(predictions, truths) if predictions else float('nan')

    print(f"\n{'=' * 90}")
    print(f"EVALUATION RESULTS -- Adapter: {ADAPTER_ID}")
    print(f"{'=' * 90}")
    print(f"  Samples evaluated:          {count}")
    print(f"  Inverted Brier Score (avg):  {avg_score:.4f}")
    print(f"  ECE (10 bins):               {ece:.4f}")
    print(f"  Mean Predicted Probability:  {mean_pred_prob:.4f}")
    print(f"  Format-Fail Rate:            {format_fail_rate:.2%} ({format_fails}/{count})")
    print(f"{'-' * 90}")
    print(f"  REFERENCE BASELINES:")
    print(f"    Always-0.50 predictor:     Brier=0.7500, ECE~=0.00, MeanPP=0.5000")
    print(f"    Perfect predictor:         Brier=1.0000, ECE=0.00, MeanPP=base_rate")
    print(f"{'=' * 90}")

    # Canary check: if mean predicted probability is stuck at 0.50, flag it.
    if abs(mean_pred_prob - 0.50) < 0.02:
        print("\n⚠️  WARNING: Mean predicted probability is ~0.50 across the eval set.")
        print("   This suggests the model has only learned format and GRPO did not move it.")
        print("   Consider: more training steps, higher temperature, or richer input features.")


if __name__ == "__main__":
    evaluate_model()
