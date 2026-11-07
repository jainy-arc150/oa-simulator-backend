import random
import sys

N_MAX = 200000
SMALL_N_MAX = 30
POOLS = ["ab", "abc", "zyx", "abcdefghijklmnopqrstuvwxyz"]


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        pool = POOLS[-1]
    else:
        n = rng.randint(1, SMALL_N_MAX)
        pool = rng.choice(POOLS)
    print("".join(rng.choice(pool) for _ in range(n)))


main()
