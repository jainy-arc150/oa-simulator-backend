import sys
from itertools import combinations

# Try every set of k towers, and every height in the set as the common height.
# (The cost |x - t| summed over the set is smallest at one of the set's own
# heights, so checking those heights is enough.)
data = sys.stdin.read().split()
n, k = int(data[0]), int(data[1])
h = [int(x) for x in data[2:2 + n]]
best = None
for chosen in combinations(range(n), k):
    heights = [h[i] for i in chosen]
    for t in heights:
        cost = sum(abs(x - t) for x in heights)
        if best is None or cost < best:
            best = cost
print(best)
