"""
Climate Market Forecasting Environment (V4)

This is a ZERO-SHOT forecasting environment. The model receives only the market
question and its resolution rules. There is NO external news retrieval, NO live
data feeds, and NO RAG pipeline. The model relies entirely on its pre-trained
internal knowledge to produce calibrated probability estimates.

Reward function: Inverted Brier Score = 1 - (p_pred - y_true)^2
  - Perfect prediction:  reward = 1.0
  - Always-0.50 baseline: reward = 0.75 (Brier = 0.25)
  - Completely wrong:     reward = 0.0

Format-fail handling (per arXiv:2505.17989v2 §2.3):
  - Training: Strict Brier — score = 0.0 on format failure (kills reward, preserves gradient pressure)
  - Evaluation: Soft Brier — score = 0.75 on format failure (neutral, doesn't distort the metric)
"""

import json
import re
from pathlib import Path

from freesolo.datasets import TaskExample
from freesolo.datasets.records import load_task_examples
from freesolo.environments import EnvironmentSingleTurn, RewardResult

ROOT = Path(__file__).parent


class ClimateMarketEnvironment(EnvironmentSingleTurn):
    """
    Scores model probability predictions against resolved binary outcomes
    using the Inverted Brier Score.
    """

    def __init__(self, split: str = "train"):
        super().__init__()
        self.split = split
        dataset_path = ROOT / "dataset" / f"{split}.jsonl"
        if dataset_path.exists():
            self.dataset = load_task_examples(dataset_path)

    def build_prompt_messages(self, example: TaskExample, prompt_text: str):
        """Maps the dataset 'input' to a system/user message array."""
        try:
            data = json.loads(example.input)
            question = data.get("question", "")
            resolution_rules = data.get("resolution_rules", "")
        except (json.JSONDecodeError, AttributeError, TypeError):
            question = example.input
            resolution_rules = "No rules provided."

        system_prompt = (
            "You are a highly calibrated forecasting agent. Your goal is to predict "
            "the probability of climate-related events occurring based on the market's "
            "resolution rules and your internal knowledge.\n"
            "You must output ONLY a float value between 0.00 and 1.00 representing the "
            "probability, formatted to exactly two decimal places. Do not output any other text."
        )

        user_prompt = (
            f"Question: {question}\n"
            f"Resolution Rules: {resolution_rules}\n\n"
            f"What is the probability of this event occurring? (0.00 to 1.00):"
        )

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]

    def score_response(self, example: TaskExample, response_text: str) -> RewardResult:
        """
        Parses the probability and calculates the inverted Brier score.
        r = 1 - (p_pred - y_true)^2

        Format-fail handling:
          - Training (split="train"): score = 0.0 (Strict Brier)
          - Evaluation (split="eval"): score = 0.75 (Soft Brier, neutral baseline)
        """
        # Soft Brier for eval, Strict Brier for training.
        format_fail_score = 0.75 if self.split == "eval" else 0.0

        if not example.record or "metadata" not in example.record:
            return RewardResult(score=format_fail_score, threshold=0.50)

        true_outcome_str = example.record["metadata"].get("resolved_outcome")
        if true_outcome_str is None:
            return RewardResult(score=format_fail_score, threshold=0.50)

        try:
            y_true = float(true_outcome_str)
        except ValueError:
            return RewardResult(score=format_fail_score, threshold=0.50)

        # Handle response objects that have a .completion attribute.
        response_str = getattr(response_text, "completion", response_text)

        match = re.search(r"^(0\.\d{2}|1\.00)$", str(response_str).strip())
        if not match:
            return RewardResult(score=format_fail_score, threshold=0.50)

        try:
            p_pred = float(match.group(1))
            if not (0.0 <= p_pred <= 1.0):
                raise ValueError
        except ValueError:
            return RewardResult(score=format_fail_score, threshold=0.50)

        brier_score = (p_pred - y_true) ** 2
        reward = 1.0 - brier_score

        return RewardResult(score=reward, threshold=0.50)


def load_environment(split: str = "train", **kwargs) -> EnvironmentSingleTurn:
    """Entry point required by Flash to load the environment."""
    return ClimateMarketEnvironment(split=split)
