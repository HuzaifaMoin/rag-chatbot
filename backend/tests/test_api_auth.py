"""Integration tests: sign up, log in, and "who am I?"."""


async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_register_returns_a_working_token(client, user):
    response = await client.get("/api/auth/me", headers=user["headers"])
    assert response.status_code == 200
    assert response.json()["email"] == user["email"]


async def test_register_same_email_twice_is_rejected(client, user):
    response = await client.post(
        "/api/auth/register", json={"email": user["email"], "password": "another-pass-123"}
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Email already registered"


async def test_register_email_is_case_insensitive(client, user):
    response = await client.post(
        "/api/auth/register", json={"email": user["email"].upper(), "password": "another-pass-123"}
    )
    assert response.status_code == 409


async def test_register_rejects_short_password(client):
    response = await client.post(
        "/api/auth/register", json={"email": "short@example.com", "password": "short"}
    )
    assert response.status_code == 422


async def test_login_with_correct_password(client, user):
    # Login uses OAuth2 form data, with the email in the "username" field.
    response = await client.post(
        "/api/auth/login", data={"username": user["email"], "password": user["password"]}
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["email"] == user["email"]


async def test_login_with_wrong_password(client, user):
    response = await client.post(
        "/api/auth/login", data={"username": user["email"], "password": "wrong-password"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email or password"


async def test_login_with_unknown_email_gives_the_same_error(client):
    # Same message as a wrong password, so attackers can't find out which emails exist.
    response = await client.post(
        "/api/auth/login", data={"username": "nobody@example.com", "password": "whatever-123"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email or password"


async def test_me_without_token(client):
    response = await client.get("/api/auth/me")
    assert response.status_code == 401


async def test_me_with_fake_token(client):
    response = await client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-real-jwt"})
    assert response.status_code == 401
