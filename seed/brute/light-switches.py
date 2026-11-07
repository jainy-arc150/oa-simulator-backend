import sys

# For every switch number that was pressed, count its presses one by one.
data = sys.stdin.read().split()
n = int(data[0])
b = [int(x) for x in data[1:1 + n]]
on = []
for x in b:
    if x not in on and b.count(x) % 2 == 1:
        on.append(x)
on.sort()
print(" ".join(map(str, on)) if on else "NONE")
