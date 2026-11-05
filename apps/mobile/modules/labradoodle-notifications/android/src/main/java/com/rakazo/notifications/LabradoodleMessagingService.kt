package com.rakazo.notifications

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

/** Expo remains the single FCM token owner; other messages use its normal delegate unless [SenderPush] renders them. */
class LabradoodleMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val data = runCatching { JSONObject(message.data["body"] ?: "{}") }.getOrNull() ?: JSONObject()
    if (!SenderPush.present(this, data)) super.onMessageReceived(message)
  }
}
