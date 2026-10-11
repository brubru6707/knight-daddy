"""Score the blind hand labels against the authors' tags, with Wilson 95% CIs, and cross-check against the general 2B.

Inputs: crypto/audit/blind_labels.txt, sample_key.csv; ~/scratch/poc1/crypto/gate_preds.parquet (general 2B, all 4,000).
Writes crypto/audit/audit_result.json.
"""
import json, os
from math import sqrt
import numpy as np, pandas as pd

D = os.path.dirname(os.path.abspath(__file__))
MAP = {"U": "Bullish", "D": "Bearish", "N": "None"}
lab = pd.read_csv(f"{D}/blind_labels.txt", sep=" ", comment="#", names=["sid", "hand"])
lab["hand"] = lab.hand.map(MAP)
k = pd.read_csv(f"{D}/sample_key.csv").merge(lab, on="sid")
assert len(k) == 2000 and k.hand.notna().all()


def wilson(x, n, z=1.96):
    p = x / n; c = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    m = (p + z * z / (2 * n)) / (1 + z * z / n)
    return [round(m - c, 3), round(m + c, 3)]


def split(df):
    n = len(df); agree = int((df.hand == df.tag).sum()); none = int((df.hand == "None").sum())
    opp = n - agree - none
    return {"n": n, "text_matches_tag": agree, "text_has_no_stance": none, "text_contradicts_tag": opp,
            "match_rate": round(agree / n, 3), "match_ci95": wilson(agree, n),
            "mismatch_rate": round(1 - agree / n, 3), "mismatch_ci95": wilson(n - agree, n),
            "contradict_rate": round(opp / n, 3), "contradict_ci95": wilson(opp, n),
            "no_stance_rate": round(none / n, 3), "no_stance_ci95": wilson(none, n),
            "match_rate_among_posts_with_a_stance": round(agree / (agree + opp), 3) if agree + opp else None,
            "match_ci95_among_posts_with_a_stance": wilson(agree, agree + opp) if agree + opp else None}


res = {"overall": split(k), "tag_Bullish": split(k[k.tag == "Bullish"]), "tag_Bearish": split(k[k.tag == "Bearish"])}

# Cross-check: general 2B (3-way argmax) on the same 200, and on all 4,000.
g = pd.read_parquet(os.path.expanduser("~/scratch/poc1/crypto/gate_preds.parquet"))
P = g[["g_p_bear", "g_p_bull", "g_p_neut"]].to_numpy()
g["g3"] = np.array(["Bearish", "Bullish", "None"])[P.argmax(1)]
k = k.merge(g[["id", "g3"]], on="id")
res["hand_vs_general2b_3way_agreement_on_sample"] = round(float((k.hand == k.g3).mean()), 3)
res["hand_vs_general2b_crosstab"] = pd.crosstab(k.hand, k.g3).to_dict()
res["general2b_on_all_4000"] = {"says_no_stance": round(float((g.g3 == "None").mean()), 3),
                                "agrees_with_tag": round(float((g.g3 == g.label).mean()), 3),
                                "contradicts_tag": round(float(((g.g3 != "None") & (g.g3 != g.label)).mean()), 3)}
json.dump(res, open(f"{D}/audit_result.json", "w"), indent=1)
print(json.dumps(res, indent=1))
