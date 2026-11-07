import sys
from math import isqrt


def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    total = 0
    for x in map(int, data[1:1 + n]):
        k = isqrt(x)  # exact integer square root, no floating point
        total += x - k * k
    print(total)


main()
