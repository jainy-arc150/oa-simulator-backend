import random
import sys

N_MAX = 200000
A_MAX = 1000000000
SMALL_N_MAX = 30
TINY_VALUE = 3
SMALL_VALUE = 2
MAX_VALUE_RANGE = 20
# Values whose plain XOR is 0 for some groups (1^2^3, 4^8^12, and 0 itself).
XOR_TRAP = [0, 1, 2, 3, 4, 8, 12]


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        a = [rng.randint(1, MAX_VALUE_RANGE) for _ in range(n)]
    else:
        n = rng.randint(1, SMALL_N_MAX)
        profile = rng.randint(0, 3)
        if profile == 0:
            a = [rng.randint(1, TINY_VALUE) for _ in range(n)]
        elif profile == 1:
            a = [rng.randint(-SMALL_VALUE, SMALL_VALUE) for _ in range(n)]
        elif profile == 2:
            a = [rng.choice(XOR_TRAP) for _ in range(n)]
        else:
            pool = [rng.randint(-A_MAX, A_MAX) for _ in range(rng.randint(1, n))]
            a = [rng.choice(pool) for _ in range(n)]

    print(n)
    print(" ".join(map(str, a)))


main()
