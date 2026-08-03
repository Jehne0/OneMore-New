import CryptoKit
import Foundation
import Security
import WidgetKit

enum WidgetNetworkConstants {
  static let endpoint = URL(string: "https://europe-west1-onemore-ca918.cloudfunctions.net/iosWidgetGateway")!
  static let keychainGroupSuffix = ".eu.desigame.onemore.widget"
  static let metadataService = "eu.desigame.onemore.widget-access"
  static let metadataAccount = "active-grant"
  static let privateKeyTag = Data("eu.desigame.onemore.widget-signing-key.v1".utf8)
}

struct WidgetAccessGrant: Codable {
  var grantId: String
  var uid: String
  var keyId: String
  var expiresAtISO: String
  var issuedAtISO: String?
  var rotateAfterISO: String?
}

struct WidgetPreparedKey: Codable {
  var keyId: String
  var publicKeyBase64: String
}

struct WidgetRemotePremium: Codable {
  var state: String
  var expirationDate: String?
  var lifetime: Bool
}

struct WidgetGatewayResponse: Codable {
  var ok: Bool?
  var status: String?
  var permanent: Bool?
  var grantExpiresAtISO: String?
  var premium: WidgetRemotePremium?
}

enum WidgetNetworkError: Error {
  case unavailable
  case invalidGrant
  case signingFailed
  case invalidResponse
  case rejected(permanent: Bool)
}

enum WidgetSecureAccessStore {
  private static let encoder = JSONEncoder()
  private static let decoder = JSONDecoder()

  private static func accessGroup() -> String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: "OneMoreKeychainAccessGroup") as? String,
          value.hasSuffix(WidgetNetworkConstants.keychainGroupSuffix), !value.contains("$(") else { return nil }
    return value
  }

  private static func baseQuery() -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: WidgetNetworkConstants.metadataService,
      kSecAttrAccount as String: WidgetNetworkConstants.metadataAccount,
    ]
    query[kSecAttrAccessGroup as String] = accessGroup() ?? "invalid.onemore.widget.access-group"
    return query
  }

  static func readGrant() -> WidgetAccessGrant? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data else { return nil }
    return try? decoder.decode(WidgetAccessGrant.self, from: data)
  }

  static func storeGrant(_ grant: WidgetAccessGrant) throws {
    let data = try encoder.encode(grant)
    let query = baseQuery()
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var add = query
      add[kSecValueData as String] = data
      add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw WidgetNetworkError.unavailable }
    } else if status != errSecSuccess {
      throw WidgetNetworkError.unavailable
    }
  }

  static func clear() {
    SecItemDelete(baseQuery() as CFDictionary)
    SecItemDelete(privateKeyQuery(returnReference: false) as CFDictionary)
  }

  private static func privateKeyQuery(returnReference: Bool) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: WidgetNetworkConstants.privateKeyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    ]
    query[kSecAttrAccessGroup as String] = accessGroup() ?? "invalid.onemore.widget.access-group"
    if returnReference {
      query[kSecReturnRef as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
    }
    return query
  }

  private static func existingPrivateKey() -> SecKey? {
    var item: CFTypeRef?
    let status = SecItemCopyMatching(privateKeyQuery(returnReference: true) as CFDictionary, &item)
    return status == errSecSuccess ? (item as! SecKey) : nil
  }

  private static func makePrivateKey(secureEnclave: Bool) -> SecKey? {
    var privateAttributes: [String: Any] = [
      kSecAttrIsPermanent as String: true,
      kSecAttrApplicationTag as String: WidgetNetworkConstants.privateKeyTag,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    privateAttributes[kSecAttrAccessGroup as String] = accessGroup() ?? "invalid.onemore.widget.access-group"
    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: privateAttributes,
    ]
    if secureEnclave { attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave }
    return SecKeyCreateRandomKey(attributes as CFDictionary, nil)
  }

  private static func privateKey() throws -> SecKey {
    if let key = existingPrivateKey() { return key }
    if let key = makePrivateKey(secureEnclave: true) ?? makePrivateKey(secureEnclave: false) { return key }
    throw WidgetNetworkError.unavailable
  }

  static func preparedKey() throws -> WidgetPreparedKey {
    let key = try privateKey()
    guard let publicKey = SecKeyCopyPublicKey(key),
          let raw = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
      throw WidgetNetworkError.unavailable
    }
    let keyId = SHA256.hash(data: raw).map { String(format: "%02x", $0) }.joined()
    return WidgetPreparedKey(keyId: keyId, publicKeyBase64: raw.base64EncodedString())
  }

  static func signature(for message: Data) throws -> String {
    let key = try privateKey()
    guard SecKeyIsAlgorithmSupported(key, .sign, .ecdsaSignatureMessageX962SHA256),
          let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, message as CFData, nil) as Data? else {
      throw WidgetNetworkError.signingFailed
    }
    return signature.base64EncodedString()
  }
}

enum WidgetNetworkClient {
  private static func payloadData(_ payload: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
  }

  private static func send(action: String, payload: [String: Any]) async throws -> WidgetGatewayResponse {
    guard let grant = WidgetSecureAccessStore.readGrant(),
          grant.uid == OneMoreWidgetStateStore.read()?.activeUid,
          let grantExpiration = parseISODate(grant.expiresAtISO), grantExpiration > Date() else {
      throw WidgetNetworkError.invalidGrant
    }
    let payloadBytes = try payloadData(payload)
    let payloadHash = SHA256.hash(data: payloadBytes).map { String(format: "%02x", $0) }.joined()
    let timestamp = Int(Date().timeIntervalSince1970)
    let nonce = UUID().uuidString.lowercased()
    let canonical = "v1\n\(grant.grantId)\n\(timestamp)\n\(nonce)\n\(action)\n\(payloadHash)"
    let signature = try WidgetSecureAccessStore.signature(for: Data(canonical.utf8))
    let body: [String: Any] = [
      "grantId": grant.grantId,
      "timestamp": timestamp,
      "nonce": nonce,
      "action": action,
      "payload": payload,
      "payloadHash": payloadHash,
      "signature": signature,
    ]
    var request = URLRequest(url: WidgetNetworkConstants.endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = 8
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys, .withoutEscapingSlashes])
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse,
          let decoded = try? JSONDecoder().decode(WidgetGatewayResponse.self, from: data) else {
      throw WidgetNetworkError.invalidResponse
    }
    if let nextExpiry = decoded.grantExpiresAtISO {
      var updatedGrant = grant
      updatedGrant.expiresAtISO = nextExpiry
      try? WidgetSecureAccessStore.storeGrant(updatedGrant)
    }
    if let premium = decoded.premium {
      try? OneMoreWidgetStateStore.applyRemotePremium(
        state: premium.state, expirationDate: premium.expirationDate, lifetime: premium.lifetime
      )
    }
    guard (200..<300).contains(http.statusCode), decoded.ok == true else {
      throw WidgetNetworkError.rejected(permanent: decoded.permanent == true || [400, 401, 403, 409].contains(http.statusCode))
    }
    return decoded
  }

  static func complete(_ mutation: WidgetMutation) async throws -> WidgetGatewayResponse {
    try await send(action: "complete", payload: [
      "challengeId": mutation.challengeId,
      "challengeType": mutation.challengeType,
      "date": mutation.date,
      "expectedDoneBefore": mutation.expectedDoneBefore,
      "mutationId": mutation.mutationId,
      "timeZoneIdentifier": TimeZone.autoupdatingCurrent.identifier,
    ])
  }

  static func refreshPremiumIfNeeded(force: Bool = false) async {
    guard let snapshot = OneMoreWidgetStateStore.read()?.snapshot, snapshot.hasValidAccountScope() else { return }
    let expiration = snapshot.premiumExpirationDate.flatMap(parseISODate)
    let nearExpiration = expiration.map { $0.timeIntervalSinceNow <= 5 * 60 } ?? false
    guard force || snapshot.premiumState == "checking" || nearExpiration else { return }
    try? OneMoreWidgetStateStore.markPremiumCheckingIfExpired()
    _ = try? await send(action: "status", payload: [
      "timeZoneIdentifier": TimeZone.autoupdatingCurrent.identifier,
    ])
  }

  static func synchronizeBeforeTimeline() async {
    await refreshPremiumIfNeeded()
    var changed = false
    for mutation in OneMoreWidgetStateStore.pendingMutations() {
      do {
        _ = try await complete(mutation)
        try? OneMoreWidgetStateStore.acknowledge([mutation.mutationId])
        changed = true
      } catch WidgetNetworkError.rejected(let permanent) where permanent {
        try? OneMoreWidgetStateStore.rejectCompletion(mutation.mutationId)
        changed = true
      } catch {
        // Offline or transient server state: retain the durable outbox item.
      }
    }
    if changed { WidgetCenter.shared.reloadAllTimelines() }
  }
}
