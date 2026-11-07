import sys
from math import gcd

# Try every moment t from 0 up to (but not including) the lcm of all periods.
# After that the flashing pattern repeats, so if no moment works, none ever does.
data = sys.stdin.read().split()
n = int(data[0])
b = [(int(data[1 + 2 * i]), int(data[2 + 2 * i])) for i in range(n)]
period = 1
for p, _ in b:
    period = period // gcd(period, p) * p
answer = -1
for t in range(period):
    if all(t % p == r for p, r in b):
        answer = t
        break
print(answer)
