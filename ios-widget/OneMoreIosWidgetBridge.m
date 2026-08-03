#import <React/RCTBridgeModule.h>
@interface RCT_EXTERN_MODULE(OneMoreIosWidgetBridge, NSObject)
RCT_EXTERN_METHOD(writeSnapshot:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(readOutbox:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(acknowledgeOutbox:(NSArray<NSString *> *)ids resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clearWidgetData:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(reloadWidgets)
RCT_EXTERN_METHOD(prepareWidgetAccessKey:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(readWidgetAccessGrant:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(storeWidgetAccessGrant:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clearWidgetAccessGrant:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
