import Foundation
import React
import WidgetKit

@objc(OneMoreIosWidgetBridge)
final class OneMoreIosWidgetBridge: NSObject {
  @objc(writeSnapshot:resolver:rejecter:)
  func writeSnapshot(_ json: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      guard let data = json.data(using: .utf8) else { throw WidgetStateError.invalidSnapshot }
      try OneMoreWidgetStateStore.updateSnapshot(data: data)
      WidgetCenter.shared.reloadAllTimelines()
      resolve(nil)
    } catch {
      reject("WRITE_FAILED", error.localizedDescription, error)
    }
  }

  @objc(readOutbox:rejecter:)
  func readOutbox(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do { resolve(try OneMoreWidgetStateStore.outboxJSON()) }
    catch { reject("READ_FAILED", error.localizedDescription, error) }
  }

  @objc(acknowledgeOutbox:resolver:rejecter:)
  func acknowledgeOutbox(_ ids: [String], resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      try OneMoreWidgetStateStore.acknowledge(Set(ids))
      resolve(nil)
    } catch {
      reject("ACK_FAILED", error.localizedDescription, error)
    }
  }

  /** Called only after an explicit logout/account deletion. */
  @objc(clearWidgetData:rejecter:)
  func clearWidgetData(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      try OneMoreWidgetStateStore.markConfirmedSignedOut()
      WidgetCenter.shared.reloadAllTimelines()
      resolve(nil)
    } catch {
      reject("CLEAR_FAILED", error.localizedDescription, error)
    }
  }

  @objc func reloadWidgets() { WidgetCenter.shared.reloadAllTimelines() }

  @objc(prepareWidgetAccessKey:rejecter:)
  func prepareWidgetAccessKey(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      let data = try JSONEncoder().encode(WidgetSecureAccessStore.preparedKey())
      resolve(String(data: data, encoding: .utf8))
    } catch { reject("KEY_FAILED", error.localizedDescription, error) }
  }

  @objc(readWidgetAccessGrant:rejecter:)
  func readWidgetAccessGrant(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    guard let grant = WidgetSecureAccessStore.readGrant(),
          let data = try? JSONEncoder().encode(grant) else { resolve(nil); return }
    resolve(String(data: data, encoding: .utf8))
  }

  @objc(storeWidgetAccessGrant:resolver:rejecter:)
  func storeWidgetAccessGrant(_ json: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      guard let data = json.data(using: .utf8) else { throw WidgetNetworkError.invalidGrant }
      try WidgetSecureAccessStore.storeGrant(try JSONDecoder().decode(WidgetAccessGrant.self, from: data))
      resolve(nil)
    } catch { reject("GRANT_FAILED", error.localizedDescription, error) }
  }

  @objc(clearWidgetAccessGrant:rejecter:)
  func clearWidgetAccessGrant(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    WidgetSecureAccessStore.clear()
    resolve(nil)
  }
  @objc static func requiresMainQueueSetup() -> Bool { false }
}
