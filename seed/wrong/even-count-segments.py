# MISTAKE: XORs the raw values instead of a random code per value. Different
# values can cancel out (1 ^ 2 ^ 3 == 0) and the value 0 changes nothing, so
# segments like [1 2 3] or [0] are wrongly counted as even.
import sys

data = sys.stdin.read().split()
n = int(data[0])
a = [int(x) for x in data[1:1 + n]]
cur = 0
seen = {0: 1}
ans = 0
for x in a:
    cur ^= x
    ans += seen.get(cur, 0)
    seen[cur] = seen.get(cur, 0) + 1
print(ans)
