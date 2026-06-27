import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../network/api_exception.dart';
import '../providers.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _e164 = RegExp(r'^\+[1-9]\d{7,14}$');
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final phone = _phone.text.trim();
    if (!_e164.hasMatch(phone)) {
      setState(() => _error = 'Enter a valid E.164 phone, e.g. +919876543210');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).requestOtp(phone);
      setState(() => _codeSent = true);
    } catch (e) {
      setState(() => _error = apiExceptionFrom(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // On success the auth state flips to authenticated and the router redirects.
      await ref.read(authControllerProvider.notifier).verifyOtp(_phone.text.trim(), _code.text.trim());
    } catch (e) {
      setState(() => _error = apiExceptionFrom(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('RoomAdda')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 12),
            Text('Sign in', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            const Text('We will send a one-time code to your phone.'),
            const SizedBox(height: 16),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            TextField(
              controller: _phone,
              enabled: !_codeSent,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Phone (E.164)',
                hintText: '+919876543210',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            if (_codeSent) ...[
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(labelText: '6-digit code', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 4),
              FilledButton(
                onPressed: _busy ? null : _verify,
                child: _busy ? const _ButtonSpinner() : const Text('Verify & sign in'),
              ),
              TextButton(
                onPressed: _busy ? null : () => setState(() {
                  _codeSent = false;
                  _code.clear();
                }),
                child: const Text('Use a different number'),
              ),
            ] else
              FilledButton(
                onPressed: _busy ? null : _sendCode,
                child: _busy ? const _ButtonSpinner() : const Text('Send code'),
              ),
          ],
        ),
      ),
    );
  }
}

class _ButtonSpinner extends StatelessWidget {
  const _ButtonSpinner();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 20,
      width: 20,
      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
    );
  }
}
