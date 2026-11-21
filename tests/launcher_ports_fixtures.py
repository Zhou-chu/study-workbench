"""Synthetic port selection constants shared by launcher test layers."""

ISOLATED_PORTS = (18001, 5056, 13001)
PORT_FLAGS = [
    "--database-port",
    "18001",
    "--api-port",
    "5056",
    "--frontend-port",
    "13001",
]
