import 'package:flutter/material.dart';

/// Fallback shown by [ErrorWidget.builder] so a widget build error never
/// crashes the app with the red error screen.
class AppErrorWidget extends StatelessWidget {
  const AppErrorWidget({super.key, this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    return Material(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: Colors.redAccent),
              const SizedBox(height: 12),
              const Text(
                'Something went wrong',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              Text(message ?? 'Please try again in a moment.', textAlign: TextAlign.center),
            ],
          ),
        ),
      ),
    );
  }
}
