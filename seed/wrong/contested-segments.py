# MISTAKE: for every two neighbouring copies p < q of a value with nothing
# larger between them, it counts the segments that contain both copies, with
# the left border stopping only at a LARGER value. A segment whose top score
# appears three or more times is then counted once for each neighbouring pair
# of copies inside it, so it is counted more than once. (The left border must
# also stop at an earlier copy of the same value.)
import sys

data = sys.stdin.read().split()
n = int(data[0])
a = [int(x) for x in data[1:1 + n]]

prev_greater = [-1] * n
stack = []
for i in range(n):
    while stack and a[stack[-1]] <= a[i]:
        stack.pop()
    prev_greater[i] = stack[-1] if stack else -1
    stack.append(i)

next_greater = [n] * n
stack = []
for i in range(n - 1, -1, -1):
    while stack and a[stack[-1]] <= a[i]:
        stack.pop()
    next_greater[i] = stack[-1] if stack else n
    stack.append(i)

last = {}
ans = 0
for q in range(n):
    v = a[q]
    if v in last:
        p = last[v]
        if next_greater[p] > q:
            ans += (p - prev_greater[p]) * (next_greater[q] - q)
    last[v] = q
print(ans)
