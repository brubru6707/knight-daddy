"""Headline sentiment classifier: Qwen3.5-2B + our QLoRA adapter.

Same prompt and scoring as ~/poc1/train_qlora.py and ~/poc1/backtest/classify.py.
Used directly by the FastAPI app (local GPU) and by modal_app.py (Modal GPU).
"""
import threading

SYSTEM = ("Classify the sentiment of the financial news tweet for investors. "
          "Answer with exactly one word: Negative (bearish), Positive (bullish), or Neutral.")
TARGETS = ["Negative", "Positive", "Neutral"]
LABELS = ["Bearish", "Bullish", "Neutral"]


class SentimentModel:
    def __init__(self, adapter_dir, base="Qwen/Qwen3.5-2B"):
        self.adapter_dir, self.base = adapter_dir, base
        self._model = None
        self._lock = threading.Lock()

    @property
    def loaded(self):
        return self._model is not None

    def load(self):
        with self._lock:
            if self._model is not None:
                return
            import torch
            from peft import PeftModel
            from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
            tok = AutoTokenizer.from_pretrained(self.adapter_dir)
            tok.padding_side = "left"
            bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                     bnb_4bit_use_double_quant=True,
                                     bnb_4bit_compute_dtype=torch.bfloat16)
            m = AutoModelForCausalLM.from_pretrained(self.base, quantization_config=bnb,
                                                     dtype=torch.bfloat16, device_map={"": 0})
            self._model = PeftModel.from_pretrained(m, self.adapter_dir).eval()
            self._tok = tok
            self._ids = [tok(t, add_special_tokens=False).input_ids[0] for t in TARGETS]

    def _prompt(self, text):
        msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}]
        return self._tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True,
                                             enable_thinking=False)

    def classify(self, texts, bs=32):
        """Return [{label, p_bear, p_bull, p_neut}] for each text."""
        import torch
        self.load()
        out = []
        with self._lock, torch.inference_mode():
            for i in range(0, len(texts), bs):
                enc = self._tok([self._prompt(t) for t in texts[i:i + bs]], return_tensors="pt",
                                padding=True, pad_to_multiple_of=16,
                                add_special_tokens=False).to("cuda")
                p = self._model(**enc, logits_to_keep=1).logits[:, -1, self._ids].float().softmax(-1)
                for row in p.cpu().tolist():
                    out.append({"label": LABELS[max(range(3), key=row.__getitem__)],
                                "p_bear": row[0], "p_bull": row[1], "p_neut": row[2]})
        return out
