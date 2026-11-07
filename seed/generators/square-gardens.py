import random
import sys

N_MAX = 100000
A_MAX = 10 ** 18
K_MAX = 10 ** 9
SMALL_N_MAX = 30
SMALL_A = 100


def near_square(rng):
    # k*k - 1, k*k or k*k + 1 for a large k: where floating sqrt goes wrong.
    k = rng.randint(1, K_MAX)
    return min(A_MAX, max(1, k * k + rng.randint(-1, 1)))


def main():
    seed = int(sys.argv[1])
    use_max = len(sys.argv) > 2 and sys.argv[2] == "max"
    rng = random.Random(seed)

    if use_max:
        n = N_MAX
        a = [near_square(rng) if rng.randint(0, 1) else rng.randint(1, A_MAX) for _ in range(n)]
    else:
        n = rng.randint(1, SMALL_N_MAX)
        profile = rng.randint(0, 2)
        if profile == 0:
            a = [rng.randint(1, SMALL_A) for _ in range(n)]
        elif profile == 1:
            a = [near_square(rng) for _ in range(n)]
        else:
            a = [rng.randint(1, A_MAX) for _ in range(n)]

    print(n)
    print(" ".join(map(str, a)))


main()
