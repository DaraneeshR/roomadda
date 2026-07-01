import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Selected bottom-nav tab on the host shell. A StateProvider so any tab body
/// (e.g. a dashboard action row) can switch tabs without a callback chain.
final hostTabIndexProvider = StateProvider<int>((ref) => 0);

/// Stable tab indices for the host shell.
abstract final class HostTab {
  static const home = 0;
  static const listings = 1;
  static const requests = 2;
  static const service = 3;
}
