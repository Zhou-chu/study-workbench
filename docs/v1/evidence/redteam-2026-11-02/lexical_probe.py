import argparse
import ast
import asyncio
import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path
from typing import Any

parser = argparse.ArgumentParser()
parser.add_argument("--source", default="api/evidence_service.py")
args = parser.parse_args()
src = Path(args.source).read_text(encoding="utf-8")
assert (
    hashlib.sha256(src.encode()).hexdigest()
    == "12d983c2e496e74307f41ba16360de60e731d731af0e28a6b9dbd0cad5ff1674"
), "Source differs from audited checkpoint"
tree = ast.parse(src)
term = next(
    n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_terms"
)
klass = next(
    n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "EvidenceService"
)
method = next(
    n
    for n in klass.body
    if isinstance(n, ast.AsyncFunctionDef) and n.name == "retrieve"
)
klass.name = "ProbeService"
klass.body = [method]
mod = ast.Module(body=[term, klass], type_ignores=[])


class InvalidInputError(Exception):
    pass


ns: dict[str, Any] = dict(
    re=re, unicodedata=unicodedata, os=os, InvalidInputError=InvalidInputError
)
exec(compile(ast.fix_missing_locations(mod), "pinned_evidence_source", "exec"), ns)


class Probe:
    retrieve = ns["ProbeService"].retrieve

    def __init__(self):
        self.records: list[dict[str, str]] = []

    async def _version(self, v):
        return {"status": "ready"}

    async def list_evidence(self, v):
        return self.records

    async def validate_citation(self, *args):
        return {"reference_validity": "valid"}


async def main():
    p = Probe()
    cases = [
        ("exact_english", "voltage drop", "Line impedance causes voltage drop."),
        ("exact_chinese", "潮流计算", "牛顿法用于潮流计算。"),
        ("cross_language", "voltage drop", "线路阻抗会导致电压下降。"),
        ("paraphrase", "汽车", "这辆轿车采用电驱动。"),
        ("broad_summary", "总结这些资料", "牛顿法采用雅可比矩阵计算节点电压。"),
    ]
    out = []
    for name, q, quote in cases:
        p.records = [
            {"evidence_id": "fixture1", "quote": quote, "source_version_id": "test1"}
        ]
        hits = await p.retrieve(q, ["test1"])
        out.append(
            {
                "case": name,
                "query": q,
                "quote": quote,
                "hits": len(hits),
                "score": hits[0]["score"] if hits else None,
            }
        )
    print(
        json.dumps(
            {
                "scope": "isolated pinned-source lexical retrieval probe; fixture store/citation validator; NOT live RAG or full tests",
                "sha": "df94d8c18bfbae217aea5c9283b7a24d38844d24",
                "cases": out,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


asyncio.run(main())
