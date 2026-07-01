import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/chat.dart';

class ChatPhotoTarget {
  final String key;
  final String uploadUrl;
  const ChatPhotoTarget({required this.key, required this.uploadUrl});
}

/// Talks to the chat endpoints. The backend is the source of truth + audit and
/// enforces the rules (participants, cancelled-booking gate, NO phone numbers);
/// the app sends messages and reads history (near-real-time via polling here;
/// a Firestore listener swaps in for production).
class ChatRepository {
  final Dio _dio;
  ChatRepository(this._dio);

  /// The conversation with the tenant's current host (null when no active stay).
  Future<Conversation?> fetchCurrent() async {
    final res = await _dio.get<dynamic>('/v1/chat/current');
    final convo = (res.data as Map<String, dynamic>)['conversation'];
    return convo == null ? null : Conversation.fromJson(convo as Map<String, dynamic>);
  }

  /// Message history, newest first (the app reverses for display).
  Future<ChatPage> listMessages(String conversationId, {String? cursor, int limit = 50}) async {
    final res = await _dio.get<dynamic>(
      '/v1/chat/$conversationId/messages',
      queryParameters: {'limit': limit, if (cursor != null) 'cursor': cursor},
    );
    final data = res.data as Map<String, dynamic>;
    return ChatPage(
      items: (data['items'] as List<dynamic>).map((e) => ChatMessage.fromJson(e as Map<String, dynamic>)).toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<ChatMessage> sendText(String conversationId, String text) async {
    final res = await _dio.post<dynamic>('/v1/chat/$conversationId/messages', data: {'kind': 'TEXT', 'text': text});
    return ChatMessage.fromJson((res.data as Map<String, dynamic>)['message'] as Map<String, dynamic>);
  }

  Future<ChatMessage> sendPhoto(String conversationId, String photoRef) async {
    final res = await _dio.post<dynamic>('/v1/chat/$conversationId/messages', data: {'kind': 'PHOTO', 'photoRef': photoRef});
    return ChatMessage.fromJson((res.data as Map<String, dynamic>)['message'] as Map<String, dynamic>);
  }

  Future<ChatPhotoTarget> requestPhotoUrl(String contentType) async {
    final res = await _dio.post<dynamic>('/v1/chat/photo-url', data: {'contentType': contentType});
    final data = res.data as Map<String, dynamic>;
    return ChatPhotoTarget(key: data['key'] as String, uploadUrl: data['uploadUrl'] as String);
  }

  Future<void> uploadBytes(String uploadUrl, Uint8List bytes, String contentType) async {
    await Dio().put<dynamic>(
      uploadUrl,
      data: Stream<List<int>>.fromIterable([bytes]),
      options: Options(headers: {
        'Content-Type': contentType,
        'Content-Length': bytes.length,
        'x-amz-server-side-encryption': 'AES256',
      }),
    );
  }

  /// Best-effort typing ping (debounced by the caller). Failures are ignored.
  Future<void> sendTyping(String conversationId, bool isTyping) async {
    try {
      await _dio.post<dynamic>('/v1/chat/$conversationId/typing', data: {'isTyping': isTyping});
    } catch (_) {/* ephemeral — never surface */}
  }

  Future<void> reportMessage(String messageId, {String? reason}) async {
    await _dio.post<dynamic>('/v1/chat/messages/$messageId/report', data: {if (reason != null) 'reason': reason});
  }
}

final chatRepositoryProvider = Provider<ChatRepository>((ref) => ChatRepository(ref.read(dioProvider)));
