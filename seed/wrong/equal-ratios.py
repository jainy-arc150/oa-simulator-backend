# MISTAKE: divides by the gcd but never fixes the sign. So 1/-2 and -1/2 become
# the different keys (1, -2) and (-1, 2), and 0/5 and 0/-7 become (0, 1) and
# (0, -1). Equal fractions with different signs are not matched.
import sys
from math import gcd

data = sys.stdin.read().split()
n = int(data[0])
seen = {}
ans = 0
for i in range(n):
    p = int(data[1 + 2 * i])
    q = int(data[2 + 2 * i])
    g = gcd(p, q)
    key = (p // g, q // g)
    ans += seen.get(key, 0)
    seen[key] = seen.get(key, 0) + 1
print(ans)
