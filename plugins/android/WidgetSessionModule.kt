package com.anonymous.OneMore

import android.appwidget.AppWidgetManager
import android.content.SharedPreferences
import android.content.res.Configuration
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class WidgetSessionModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  private val preferences: SharedPreferences
    get() = reactApplicationContext.getSharedPreferences(
      WidgetSessionContract.PREFERENCES_NAME,
      0,
    )

  private fun mask(value: String): String =
    if (value.length <= 2) "***" else "${value.take(2)}***${value.takeLast(1)}"

  override fun getName(): String = "OneMoreWidgetSession"

  @ReactMethod
  fun setActiveUid(uid: String?, promise: Promise) {
    try {
      val normalized = uid?.trim()?.takeIf { it.isNotEmpty() }
      val editor = preferences.edit()
      if (normalized == null) editor.remove(WidgetSessionContract.ACTIVE_UID_KEY)
      else editor.putString(WidgetSessionContract.ACTIVE_UID_KEY, normalized)
      check(editor.commit()) { "SharedPreferences commit failed" }
      Log.d(
        "OneMoreWidgetSession",
        "Active UID write uid=${normalized?.let(::mask) ?: "<signed-out>"}",
      )
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("WIDGET_SESSION_WRITE_FAILED", error)
    }
  }

  @ReactMethod
  fun getActiveUid(promise: Promise) {
    try {
      val uid = preferences.getString(WidgetSessionContract.ACTIVE_UID_KEY, null)
      Log.d("OneMoreWidgetSession", "Active UID read uid=${uid?.let(::mask) ?: "<missing>"}")
      promise.resolve(uid)
    } catch (error: Exception) {
      promise.reject("WIDGET_SESSION_READ_FAILED", error)
    }
  }

  @ReactMethod
  fun setAccountSnapshot(uid: String, snapshotJson: String?, promise: Promise) {
    try {
      val normalized = uid.trim().also { require(it.isNotEmpty()) }
      val key = WidgetSessionContract.ACCOUNT_SNAPSHOT_KEY_PREFIX + normalized
      val editor = preferences.edit()
      if (snapshotJson == null) editor.remove(key) else editor.putString(key, snapshotJson)
      check(editor.commit()) { "SharedPreferences commit failed" }
      Log.d(
        "OneMoreWidgetSession",
        "Account snapshot write uid=${mask(normalized)} present=${snapshotJson != null}",
      )
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("WIDGET_ACCOUNT_SNAPSHOT_WRITE_FAILED", error)
    }
  }

  @ReactMethod
  fun getAccountSnapshot(uid: String, promise: Promise) {
    try {
      val normalized = uid.trim().also { require(it.isNotEmpty()) }
      val value = preferences.getString(
        WidgetSessionContract.ACCOUNT_SNAPSHOT_KEY_PREFIX + normalized,
        null,
      )
      Log.d(
        "OneMoreWidgetSession",
        "Account snapshot read uid=${mask(normalized)} present=${value != null}",
      )
      promise.resolve(value)
    } catch (error: Exception) {
      promise.reject("WIDGET_ACCOUNT_SNAPSHOT_READ_FAILED", error)
    }
  }

  @ReactMethod
  fun getWidgetDimensions(widgetId: Int, promise: Promise) {
    try {
      val options = AppWidgetManager.getInstance(reactApplicationContext)
        .getAppWidgetOptions(widgetId)
      val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
      val maxWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, minWidth)
      val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
      val maxHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, minHeight)
      val landscape = reactApplicationContext.resources.configuration.orientation ==
        Configuration.ORIENTATION_LANDSCAPE
      val availableWidth = if (landscape) maxWidth else minWidth
      val availableHeight = if (landscape) minHeight else maxHeight
      val result = Arguments.createMap().apply {
        putInt("minWidth", minWidth)
        putInt("maxWidth", maxWidth)
        putInt("minHeight", minHeight)
        putInt("maxHeight", maxHeight)
        putString("orientation", if (landscape) "landscape" else "portrait")
        putInt("availableWidth", availableWidth)
        putInt("availableHeight", availableHeight)
      }
      Log.d(
        "OneMoreWidgetSession",
        "Widget dimensions widgetId=$widgetId minWidth=$minWidth maxWidth=$maxWidth " +
          "minHeight=$minHeight maxHeight=$maxHeight orientation=" +
          "${if (landscape) "landscape" else "portrait"} " +
          "availableWidth=$availableWidth availableHeight=$availableHeight",
      )
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("WIDGET_DIMENSIONS_READ_FAILED", error)
    }
  }
}
