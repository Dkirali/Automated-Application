import os
import pytest

os.environ["JOBBOT_DB"] = ":memory:"

import jobbot.db.database as db_module

@pytest.fixture(autouse=True)
def reset_db():
    """Reset the in-memory database before each test"""
    # Reset the global connection
    db_module._conn = None
    yield
