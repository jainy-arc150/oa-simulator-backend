import sys

# Check every pair of bookings for a shared moment.
data = sys.stdin.read().split()
n = int(data[0])
b = [(int(data[1 + 2 * i]), int(data[2 + 2 * i])) for i in range(n)]
ans = 0
for i in range(n):
    for j in range(i + 1, n):
        if max(b[i][0], b[j][0]) <= min(b[i][1], b[j][1]):
            ans += 1
print(ans)
