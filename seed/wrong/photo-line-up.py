# MISTAKE: sorts from shortest to tallest and then reverses the list. Reversing
# also reverses the order of people with equal heights, so among equal heights
# the larger number comes first (for "5 5" it prints "2 1" instead of "1 2").
import sys

data = sys.stdin.read().split()
n = int(data[0])
h = [int(x) for x in data[1:1 + n]]
order = sorted(range(n), key=lambda i: h[i])
order.reverse()
print(" ".join(str(i + 1) for i in order))
