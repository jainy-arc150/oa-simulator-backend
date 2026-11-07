# MISTAKE: assumes the cheapest k towers are the k neighbours (in sorted order)
# with the smallest spread (largest minus smallest), and only prices that one
# window. A window with a larger spread can still be cheaper when most of its
# towers are already equal (10 10 14 14 costs 8, but 20 25 25 25 costs 5).
import sys

data = sys.stdin.read().split()
n, k = int(data[0]), int(data[1])
h = sorted(int(x) for x in data[2:2 + n])
best_l = 0
for l in range(n - k + 1):
    if h[l + k - 1] - h[l] < h[best_l + k - 1] - h[best_l]:
        best_l = l
window = h[best_l:best_l + k]
med = window[(k - 1) // 2]
print(sum(abs(x - med) for x in window))
