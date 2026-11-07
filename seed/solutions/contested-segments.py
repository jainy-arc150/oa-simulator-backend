import sys


def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    a = list(map(int, data[1:1 + n]))

    # A segment is NOT contested exactly when its top score appears once.
    # Such a segment is owned by the position i of that single top score:
    # l lies after the previous position with a value >= a[i], and
    # r lies before the next position with a value >= a[i].
    left = [0] * n
    stack = []
    for i in range(n):
        x = a[i]
        while stack and a[stack[-1]] < x:
            stack.pop()
        left[i] = i - (stack[-1] if stack else -1)
        stack.append(i)

    unique_top = 0
    stack = []
    for i in range(n - 1, -1, -1):
        x = a[i]
        while stack and a[stack[-1]] < x:
            stack.pop()
        right = (stack[-1] if stack else n) - i
        unique_top += left[i] * right
        stack.append(i)

    print(n * (n + 1) // 2 - unique_top)


main()
