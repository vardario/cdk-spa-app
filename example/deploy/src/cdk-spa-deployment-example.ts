import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import path from 'node:path';
import { SpaApp } from '@vardario/cdk-spa-app/src/spa-app.js';
import { fileURLToPath } from 'node:url';

export class CdkSpaDeploymentExample extends cdk.Stack {
  public reactApp: SpaApp;
  public svelteApp: SpaApp;
  public readonly reactAppUrl: cdk.CfnOutput;
  public readonly svelteAppUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    this.reactApp = new SpaApp(this, 'FrontendReactApp', {
      spaBuildPath: path.resolve(__dirname, '../../react-app/build'),
      config: {
        region: cdk.Stack.of(this).region
      }
    });

    this.svelteApp = new SpaApp(this, 'FrontendSvelteApp', {
      spaBuildPath: path.resolve(__dirname, '../../svelte-app/build'),
      config: {
        region: cdk.Stack.of(this).region
      }
    });

    this.reactAppUrl = new cdk.CfnOutput(this, 'FrontendReactAppUrl', {
      value: this.reactApp.appUrl
    });

    this.svelteAppUrl = new cdk.CfnOutput(this, 'FrontendSvelteAppUrl', {
      value: this.svelteApp.appUrl
    });
  }
}
