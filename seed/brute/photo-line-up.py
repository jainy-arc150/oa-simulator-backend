import sys

# Repeatedly pick the tallest person left; on a tie, the smallest number.
data = sys.stdin.read().split()
n = int(data[0])
h = [int(x) for x in data[1:1 + n]]
left = list(range(1, n + 1))
order = []
while left:
    best = left[0]
    for p in left:
        if h[p - 1] > h[best - 1] or (h[p - 1] == h[best - 1] and p < best):
            best = p
    order.append(best)
    left.remove(best)
print(" ".join(map(str, order)))
