# MISTAKE: after merging a beacon, the combined period is set to the PRODUCT
# m * p instead of the least common multiple. When periods share factors, the
# later steps jump in too-large strides and can skip the earliest common
# moment, so the printed moment is valid but not the earliest
# (for periods 2, 2, 3 with remainders 1, 1, 0 it prints 9 instead of 3).
import sys
from math import gcd

data = sys.stdin.read().split()
n = int(data[0])
t, m = 0, 1
answer = None
for i in range(n):
    p = int(data[1 + 2 * i])
    r = int(data[2 + 2 * i])
    g = gcd(m, p)
    diff = r - t
    if diff % g != 0:
        answer = -1
        break
    step = p // g
    k = 0
    if step > 1:
        k = (diff // g) * pow(m // g, -1, step) % step
    t += k * m
    m = m * p
    t %= m
print(answer if answer is not None else t)
