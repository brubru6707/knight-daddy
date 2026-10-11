"""Append a batch of blind labels ("sid L" pairs, L in U/D/N) read from stdin to blind_labels.txt.

  python append_labels.py <first_sid> <last_sid> < labels
Checks the batch covers exactly first..last and none of those sids are already labeled.
"""
import os, sys

D = os.path.dirname(os.path.abspath(__file__))
lo, hi = int(sys.argv[1]), int(sys.argv[2])
tok = sys.stdin.read().split()
pairs = list(zip(tok[::2], tok[1::2]))
assert [int(a) for a, _ in pairs] == list(range(lo, hi + 1)), "sids not contiguous"
assert all(b in "UDN" for _, b in pairs)
done = {int(l.split()[0]) for l in open(f"{D}/blind_labels.txt") if l.strip() and not l.startswith("#")}
assert not done & set(range(lo, hi + 1)), "already labeled"
open(f"{D}/blind_labels.txt", "a").write("".join(f"{a} {b}\n" for a, b in pairs))
print("appended", len(pairs), "| total", len(done) + len(pairs))
