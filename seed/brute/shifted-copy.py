import sys

# Try every shift from 0 to 25 on the whole string.
data = sys.stdin.read().split()
s, t = data[0], data[1]
answer = -1
for k in range(26):
    shifted = "".join(chr((ord(c) - ord("a") + k) % 26 + ord("a")) for c in s)
    if shifted == t:
        answer = k
        break
print(answer)
