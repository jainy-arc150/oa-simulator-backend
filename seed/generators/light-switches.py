import random
import sys

N_MAX = 5000
B_MAX = 1000000000
SMALL_N_MAX = 30
SMALL_B = 10
MAX_POOL = 100000
# Numbers whose text order differs from their numeric order.
TEXT_TRAP = [3, 30, 300, 1000000000, 9, 99, 100]


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        b = [rng.randint(1, MAX_POOL) for _ in range(n)]
    else:
        n = rng.randint(1, SMALL_N_MAX)
        profile = rng.randint(0, 2)
        if profile == 0:
            pool = list(range(1, SMALL_B + 1))
        elif profile == 1:
            pool = TEXT_TRAP
        else:
            pool = [rng.randint(1, B_MAX) for _ in range(rng.randint(1, n))]
        b = [rng.choice(pool) for _ in range(n)]

    print(n)
    print(" ".join(map(str, b)))


main()
