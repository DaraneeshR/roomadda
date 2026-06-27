/// RoomAdda shared core: networking, auth, theme, money, design-system widgets,
/// DI providers, shared sign-in UI, the role-aware router gate, and the app
/// bootstrap. Both the tenant and host_agent apps depend on this package.
/// Nothing role-specific lives here — a tenant-only or host/agent-only screen
/// belongs in its app, never in core.
library roomadda_core;

// Config & money
export 'src/config/env.dart';
export 'src/money/paise.dart';

// Errors & crash reporting
export 'src/error/app_error_widget.dart';
export 'src/error/crash_reporter.dart';

// Auth: domain models, state machine, controller, session
export 'src/auth/models.dart';
export 'src/auth/auth_state.dart';
export 'src/auth/auth_controller.dart';
export 'src/auth/auth_repository.dart';
export 'src/auth/session_manager.dart';

// Networking (public surface)
export 'src/network/api_exception.dart';

// Design system: theme tokens + widgets
export 'src/theme/app_theme.dart';
export 'src/theme/app_colors.dart';
export 'src/theme/app_radii.dart';
export 'src/theme/app_shadows.dart';
export 'src/theme/app_typography.dart';
export 'src/widgets/widgets.dart';

// DI providers (dio + auth) + per-app audience
export 'src/app_audience.dart';
export 'src/providers.dart';

// Shared UI + role-aware router gate
export 'src/auth_ui/splash_screen.dart';
export 'src/auth_ui/login_screen.dart';
export 'src/auth_ui/wrong_app_screen.dart';
export 'src/router/auth_gate.dart';

// App bootstrap (zone guard + crash reporting + dotenv)
export 'src/bootstrap.dart';
