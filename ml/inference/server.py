from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel, PeftConfig
import json
import re

app = FastAPI(title="Climate Market Opening Probability Inference Server")

class PredictRequest(BaseModel):
    question: str
    region: str
    category: str
    news_context: str

# Globals for model and tokenizer
base_model_name = "Qwen/Qwen3.5-4B"
adapter_model_name = "your-grpo-run-id" # Replace with actual run ID after training
model = None
tokenizer = None

@app.on_event("startup")
def load_model():
    global model, tokenizer
    try:
        # Note: In a real environment, uncomment to load models.
        # This is commented out for scaffolding purposes so the server can run without downloading weights.
        '''
        print("Loading base model and tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(base_model_name)
        base_model = AutoModelForCausalLM.from_pretrained(base_model_name, torch_dtype=torch.float16, device_map="auto")
        print(f"Loading LoRA adapter: {adapter_model_name}...")
        model = PeftModel.from_pretrained(base_model, adapter_model_name)
        model.eval()
        print("Model loaded successfully.")
        '''
        pass
    except Exception as e:
        print(f"Error loading model: {e}")

@app.post("/predict")
async def predict(request: PredictRequest):
    # Match the exact format used during training
    system_prompt = (
        "You are a highly calibrated forecasting agent. Your goal is to predict "
        "the probability of climate-related events occurring based on historical news context.\n"
        "You must output ONLY a float value between 0.00 and 1.00 representing the probability, "
        "formatted to exactly two decimal places. Do not output any other text."
    )

    user_prompt = (
        f"Question: {request.question}\n"
        f"News Context: {request.news_context}\n\n"
        f"What is the probability of this event occurring? (0.00 to 1.00):"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    # Mock inference logic if model is not loaded
    if model is None or tokenizer is None:
        # Just returning a dummy value for development of the frontend
        return {"probability": 0.50}

    try:
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(text, return_tensors="pt").to(model.device)
        
        with torch.no_grad():
            outputs = model.generate(**inputs, max_new_tokens=10, temperature=0.0)
            
        response_text = tokenizer.decode(outputs[0][inputs['input_ids'].shape[1]:], skip_special_tokens=True).strip()
        
        # Parse output ensuring it matches our strict float regex
        match = re.search(r"^(0\.\d{2}|1\.00)$", response_text)
        if match:
            prob = float(match.group(1))
            return {"probability": prob}
        else:
            print(f"Model failed to generate structured float. Output: {response_text}")
            return {"probability": 0.50} # Fallback
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
