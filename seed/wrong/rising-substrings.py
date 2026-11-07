# MISTAKE: keeps a SET of letters seen so far instead of their counts. For each
# position it adds the number of DIFFERENT smaller letters seen before, so a
# smaller letter that appeared several times is counted only once
# (for "aab" it prints 1 instead of 2).
import sys

s = sys.stdin.read().split()[0]
seen = set()
ans = 0
for ch in s:
    ans += sum(1 for x in seen if x < ch)
    seen.add(ch)
print(ans)
