# MISTAKE: greedy. It keeps the current stamp length p and, as soon as the next
# letter breaks it (s[i] != s[i - p]), jumps straight to p = i + 1 (the whole
# prefix). A shorter stamp between the old p and i + 1 may exist, so it can
# give too large a value (for "abaa" it uses 4 instead of 3).
import sys

s = sys.stdin.read().split()[0]
p = 1
total = 0
for i in range(len(s)):
    if i >= p and s[i] != s[i - p]:
        p = i + 1
    total += p
print(total)
