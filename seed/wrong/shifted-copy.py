# MISTAKE: compares the raw differences ord(t[i]) - ord(s[i]) and only takes
# the result modulo 26 at the very end. When some letters wrap around past z
# and others do not (for example s = "az", t = "ba"), the raw differences are
# not equal (1 and -25), so it wrongly prints -1.
import sys

data = sys.stdin.read().split()
s, t = data[0], data[1]
d = ord(t[0]) - ord(s[0])
if all(ord(b) - ord(a) == d for a, b in zip(s, t)):
    print(d % 26)
else:
    print(-1)
