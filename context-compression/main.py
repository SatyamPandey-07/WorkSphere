import argparse
import logging
import sys


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger("context-compression")


def run_server(args):
    from .server.server import CompressionServer

    server = CompressionServer(
        host=args.host,
        port=args.port,
        dimension=args.dimension,
        max_tokens=args.max_tokens,
        similarity_threshold=args.threshold,
    )
    logger.info(
        f"Starting compression server on {args.host}:{args.port} "
        f"(dim={args.dimension}, max_tokens={args.max_tokens}, "
        f"threshold={args.threshold})"
    )
    server.start()


def run_demo(args):
    from .compression.compressor import ContextCompressor

    compressor = ContextCompressor(
        dimension=args.dimension,
        max_tokens=args.max_tokens,
        similarity_threshold=args.threshold,
    )

    demo_messages = [
        ("user", "What is the capital of France?"),
        ("assistant", "The capital of France is Paris."),
        ("user", "Tell me about French cuisine."),
        (
            "assistant",
            "French cuisine is known for its rich flavors and techniques.",
        ),
        ("user", "What's the best time to visit Paris?"),
        (
            "assistant",
            "Spring (April-June) and fall (September-November) are ideal.",
        ),
        ("user", "What is the capital of France?"),
        (
            "assistant",
            "Paris is the capital and largest city of France.",
        ),
        ("user", "Recommend some French dishes."),
        (
            "assistant",
            "Try croissants, coq au vin, bouillabaisse, and crème brûlée.",
        ),
    ]

    for role, content in demo_messages:
        compressor.add_message(role, content)

    print(f"\nIndex built with {compressor.index.size()} messages\n")

    stats = compressor.get_stats()
    print(f"Stats: {stats}\n")

    test_queries = ["Paris travel", "French food", "France geography"]
    for query in test_queries:
        print(f"\n--- Query: '{query}' ---")
        results = compressor.get_relevant_context(query, max_results=3)
        for r in results:
            print(
                f"  [{r['role']}] sim={r['similarity']:.3f} "
                f"tokens={r['tokens']}: {r['content'][:60]}"
            )

    print(f"\n--- Before deduplication: {compressor.index.size()} messages ---")
    removed = compressor.deduplicate(threshold=args.threshold)
    print(f"--- After deduplication: removed={removed}, remaining={compressor.index.size()} ---\n")

    compressed, tokens = compressor.compress_context("French cuisine and Paris travel")
    print(f"Compressed context: {len(compressed)} items, {tokens} tokens\n")
    for c in compressed:
        print(f"  [{c['role']}] sim={c['similarity']:.3f}: {c['content'][:60]}")

    print("\nDemo completed successfully!")


def _add_common_args(subparser):
    subparser.add_argument(
        "--dimension", type=int, default=128, help="Embedding dimension"
    )
    subparser.add_argument(
        "--max-tokens",
        type=int,
        default=4096,
        help="Maximum token window",
    )
    subparser.add_argument(
        "--threshold",
        type=float,
        default=0.85,
        help="Similarity threshold for deduplication",
    )


def main():
    parser = argparse.ArgumentParser(
        description="Multi-agent AI context compression engine"
    )

    subparsers = parser.add_subparsers(dest="command")

    server_parser = subparsers.add_parser("server", help="Run the compression server")
    _add_common_args(server_parser)
    server_parser.add_argument(
        "--host", type=str, default="0.0.0.0", help="Server host"
    )
    server_parser.add_argument(
        "--port", type=int, default=8890, help="Server port"
    )

    demo_parser = subparsers.add_parser("demo", help="Run a demo of the engine")
    _add_common_args(demo_parser)

    args = parser.parse_args()

    if args.command == "server":
        run_server(args)
    elif args.command == "demo":
        run_demo(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
