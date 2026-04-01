from engine.safety import classify_stop_signal, StopSignal


def test_captcha_detected():
    assert classify_stop_signal("captcha") == StopSignal.CAPTCHA


def test_login_redirect():
    assert classify_stop_signal("login_redirect") == StopSignal.SESSION_EXPIRED


def test_unknown_signal_is_none():
    assert classify_stop_signal("unknown") is None


def test_rate_limit_signal():
    assert classify_stop_signal("rate_limit") == StopSignal.RATE_LIMITED
