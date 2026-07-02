import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Selected bottom-nav tab on the agent shell. A StateProvider so a body (e.g. a
/// dashboard action) can switch tabs without a callback chain.
final agentTabIndexProvider = StateProvider<int>((ref) => 0);

/// Stable tab indices for the agent shell.
abstract final class AgentTab {
  static const today = 0;
  static const bookings = 1;
  static const performance = 2;
}
