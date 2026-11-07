import sys
from collections import Counter

# Try every segment and count every value in it.
data = sys.stdin.read().split()
n = int(data[0])
a = [int(x) for x in data[1:1 + n]]
ans = 0
for l in range(n):
    for r in range(l, n):
        if all(c % 2 == 0 for c in Counter(a[l:r + 1]).values()):
            ans += 1
print(ans)
