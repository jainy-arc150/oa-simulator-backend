# MISTAKE: off-by-one in the sliding window. A position is added to the
# counter one step too late, so the code counts pairs with j - i > k instead of
# j - i >= k, and misses every pair whose distance is exactly k.
import sys

data = sys.stdin.read().split()
n, k = int(data[0]), int(data[1])
a = [int(x) for x in data[2:2 + n]]
seen = {}
ans = 0
for j in range(k + 1, n):
    v = a[j - k - 1]
    seen[v] = seen.get(v, 0) + 1
    ans += seen.get(a[j], 0)
print(ans)
