"""Direct unsupported CommandService admission without backend activity."""

import pytest
from command_capabilities_fixtures import CASES
from command_capabilities_fixtures import backend as _backend

from api.command_service import CommandService
from open_notebook.exceptions import OpenNotebookError

backend = _backend


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args,method,path,code", CASES)
async def test_unsupported_service_raises_typed_capability_error(
    backend, name, args, method, path, code
):
    with pytest.raises(OpenNotebookError, match=f"^{code}$") as raised:
        await getattr(CommandService, name)(*args)
    assert type(raised.value).__name__ == "UnsupportedCapabilityError"
    for dependency in backend:
        dependency.assert_not_called()
