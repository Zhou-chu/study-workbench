"""Direct route-to-service composition without HTTP or a real backend."""

import pytest
from command_capabilities_fixtures import CASES
from command_capabilities_fixtures import backend as _backend

from api.routers import commands
from open_notebook.exceptions import OpenNotebookError

backend = _backend


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args,method,path,code", CASES)
async def test_router_propagates_capability_error(
    backend, name, args, method, path, code
):
    with pytest.raises(OpenNotebookError, match=f"^{code}$"):
        await getattr(commands, name)(*args)
