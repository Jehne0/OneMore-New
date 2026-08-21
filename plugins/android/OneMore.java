package com.anonymous.OneMore.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import com.reactnativeandroidwidget.RNWidgetProvider;
import java.util.Calendar;

public class OneMore extends RNWidgetProvider {
  private static final String ACTION_MIDNIGHT_REFRESH =
      "com.anonymous.OneMore.action.MIDNIGHT_WIDGET_REFRESH";
  private static final int MIDNIGHT_REQUEST_CODE = 2601;

  private static PendingIntent midnightIntent(Context context, int flags) {
    Intent intent = new Intent(context, OneMore.class).setAction(ACTION_MIDNIGHT_REFRESH);
    return PendingIntent.getBroadcast(
        context,
        MIDNIGHT_REQUEST_CODE,
        intent,
        flags | PendingIntent.FLAG_IMMUTABLE);
  }

  private static long nextMidnightRefresh(long now) {
    Calendar next = Calendar.getInstance();
    next.setTimeInMillis(now);
    next.add(Calendar.DAY_OF_YEAR, 1);
    next.set(Calendar.HOUR_OF_DAY, 0);
    next.set(Calendar.MINUTE, 1);
    next.set(Calendar.SECOND, 0);
    next.set(Calendar.MILLISECOND, 0);
    return next.getTimeInMillis();
  }

  private static void cancelMidnightRefresh(Context context) {
    AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    PendingIntent pending = midnightIntent(context, PendingIntent.FLAG_NO_CREATE);
    if (alarms == null || pending == null) return;
    alarms.cancel(pending);
    pending.cancel();
  }

  private static void scheduleOrCancelMidnightRefresh(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] widgetIds = manager.getAppWidgetIds(new ComponentName(context, OneMore.class));
    if (widgetIds.length == 0) {
      cancelMidnightRefresh(context);
      return;
    }
    AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (alarms == null) return;
    alarms.setAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        nextMidnightRefresh(System.currentTimeMillis()),
        midnightIntent(context, PendingIntent.FLAG_UPDATE_CURRENT));
  }

  private static void refreshAllWidgets(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] widgetIds = manager.getAppWidgetIds(new ComponentName(context, OneMore.class));
    if (widgetIds.length > 0) new OneMore().onUpdate(context, manager, widgetIds);
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent.getAction();
    if (ACTION_MIDNIGHT_REFRESH.equals(action)) {
      refreshAllWidgets(context);
      scheduleOrCancelMidnightRefresh(context);
      return;
    }
    super.onReceive(context, intent);
    if (Intent.ACTION_BOOT_COMPLETED.equals(action)
        || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        || Intent.ACTION_CONFIGURATION_CHANGED.equals(action)
        || Intent.ACTION_TIME_CHANGED.equals(action)
        || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
      refreshAllWidgets(context);
      scheduleOrCancelMidnightRefresh(context);
    }
  }

  @Override
  public void onEnabled(Context context) {
    super.onEnabled(context);
    scheduleOrCancelMidnightRefresh(context);
  }

  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
    super.onUpdate(context, manager, widgetIds);
    scheduleOrCancelMidnightRefresh(context);
  }

  @Override
  public void onDeleted(Context context, int[] widgetIds) {
    super.onDeleted(context, widgetIds);
    scheduleOrCancelMidnightRefresh(context);
  }

  @Override
  public void onDisabled(Context context) {
    super.onDisabled(context);
    cancelMidnightRefresh(context);
  }
}
