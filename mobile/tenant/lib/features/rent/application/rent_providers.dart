import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/rent_repository.dart';
import '../domain/rent_invoice.dart';

/// The tenant's rent history (newest due first). Powers both the dashboard rent
/// card (its first relevant invoice) and the history screen. Invalidate to
/// refresh after a payment confirms.
final rentInvoicesProvider = FutureProvider<RentPage>(
  (ref) => ref.read(rentRepositoryProvider).listMine(limit: 50),
);

/// One invoice by id — the payment screen loads this before starting Razorpay.
final rentInvoiceProvider = FutureProvider.autoDispose.family<RentInvoice, String>(
  (ref, id) => ref.read(rentRepositoryProvider).fetchInvoice(id),
);
