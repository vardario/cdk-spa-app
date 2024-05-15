import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as cfo from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3d from 'aws-cdk-lib/aws-s3-deployment';
import * as cm from 'aws-cdk-lib/aws-certificatemanager';
import * as r53 from 'aws-cdk-lib/aws-route53';
import * as r53t from 'aws-cdk-lib/aws-route53-targets';
import fs from 'node:fs';
import os from 'node:os';

import childProcess from 'node:child_process';

import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface SpaAppConstructProps {
  /**
   * The name for the backing s3 Bucket.
   *
   * Remarks
   *  In case you define a @see domainName, the name of the bucket will be
   *  the same as @see domainName
   */
  bucketName?: string;

  /**
   * Optional config object which will be used to generate a `config.json` file
   * in the root of the SpaApp deployment.
   *
   * This object will be converted to json and can include deploy-time dependent values
   * which will be resolved before creating the `config.json`.
   *
   * An example for a config object with deploy-time dependent values can look like this.
   *
   * @example
   *
   * config: {
   *   userPoolId: apiStack.userPoolId.value,
   *   userPoolWebClientId: apiStack.userPoolWebClientId.value,
   *   apiV1: apiStack.domainApiUrl.value
   * }
   */
  config?: any;

  /**
   * When specifying the `domain` prop, this construct will also create a `CloudFrond` distribution and will
   * create the Route53 records for the domain and will take care to connect the provided SSL certificates.
   */
  domain?: {
    /**
     * Aliases under which the app is also available.
     * The given certificate has to support the additional aliases as well.
     */
    aliases?: string[];

    /**
     * ARN to a certificate which will be used for the underlying CloudFront distribution.
     *
     * Remarks
     *  1. Certificate has to be deployed in us-east-1
     *  2. Certificate has to be compatible with the given @see domainName .
     */
    domainCertificateArn: string;

    /**
     * Fully qualified domain name under which the spa app will be available.
     */
    domainName: string;

    /**
     * Reference to a hosted zone compatible with the given @see domainName .
     */
    hostedZone: r53.IHostedZone;
  };

  /**
   * Defaults to @see RemovalPolicy.DESTROY
   */
  removalPolicy?: RemovalPolicy;

  /**
   * Path to the Spa application.
   */
  spaBuildPath: string;
}
/**
 * Construct to deploy a single page application (SPA) to AWS.
 */
export class SpaApp extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly cloudfrontDistribution: cf.Distribution;
  public readonly appUrl: string;
  public readonly cloudFrontUrl: string;

  createBucket() {
    const bucketName = (this.stackProps.domain && this.stackProps.domain.domainName) || this.stackProps.bucketName;

    const bucket = new s3.Bucket(this, 'SpaAppBucket', {
      bucketName,
      removalPolicy: this.stackProps.removalPolicy,
      autoDeleteObjects: this.stackProps.removalPolicy === RemovalPolicy.DESTROY
    });

    const tempDir = os.tmpdir();

    const rootFilesDir = fs.mkdtempSync(tempDir + '/');
    const otherFilesDir = fs.mkdtempSync(tempDir + '/');

    /**
     * Copy root files only
     */
    childProcess.execSync(`find ${this.stackProps.spaBuildPath} -maxdepth 1 -type f -exec cp {} ${rootFilesDir} \\;`);

    /**
     * Copy all files except root files
     */
    childProcess.execSync(
      `find ${this.stackProps.spaBuildPath} -mindepth 1 -maxdepth 1 -type d -exec cp -r {} ${otherFilesDir} \\;`
    );

    new s3d.BucketDeployment(this, 'SpaAppIndexDeployment', {
      destinationBucket: bucket,
      sources: [s3d.Source.asset(rootFilesDir)],
      cacheControl: [s3d.CacheControl.fromString('max-age=0, no-cache, no-store, must-revalidate')],
      prune: false
    });

    new s3d.BucketDeployment(this, 'SpaAppAssetDeployment', {
      destinationBucket: bucket,
      sources: [s3d.Source.asset(otherFilesDir)],
      cacheControl: [s3d.CacheControl.fromString('max-age=31536000, public')],
      prune: false
    });

    return bucket;
  }

  createConfig(bucket: s3.Bucket) {
    if (this.stackProps.config !== undefined) {
      new AwsCustomResource(this, 'SpaAppConfigDeployment', {
        logRetention: RetentionDays.ONE_DAY,
        onUpdate: {
          action: 'putObject',
          parameters: {
            Body: Stack.of(this).toJsonString(this.stackProps.config),
            Bucket: bucket.bucketName,
            CacheControl: 'max-age=0, no-cache, no-store, must-revalidate',
            ContentType: 'application/json',
            Key: 'config.json'
          },
          physicalResourceId: PhysicalResourceId.of('config'),
          service: 'S3'
        },
        policy: AwsCustomResourcePolicy.fromStatements([
          new PolicyStatement({
            actions: ['s3:PutObject'],
            resources: [bucket.arnForObjects('config.json')]
          })
        ])
      });
    }
  }

  createCloudFrontDistribution(bucket: s3.Bucket) {
    const certificate =
      this.stackProps.domain &&
      cm.Certificate.fromCertificateArn(
        this,
        'SpaAppCloudFrontDistributionCertificate',
        this.stackProps.domain.domainCertificateArn
      );

    const domainNames = this.stackProps.domain
      ? [this.stackProps.domain.domainName, ...(this.stackProps.domain.aliases || [])]
      : undefined;

    const cloudfrontDistribution = new cf.Distribution(this, 'SpaAppCloudFrontDistribution', {
      domainNames,
      certificate,
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      httpVersion: cf.HttpVersion.HTTP2,
      minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: new cfo.S3Origin(bucket),
        allowedMethods: cf.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        }
      ]
    });

    this.stackProps.domain &&
      new r53.ARecord(this, 'SvelteAlias', {
        recordName: `${this.stackProps.domain.domainName}.`,
        target: r53.RecordTarget.fromAlias(new r53t.CloudFrontTarget(cloudfrontDistribution)),
        zone: this.stackProps.domain.hostedZone
      });

    return cloudfrontDistribution;
  }

  constructor(
    scope: Construct,
    id: string,
    private readonly stackProps: SpaAppConstructProps
  ) {
    super(scope, id);

    this.stackProps.removalPolicy = this.stackProps.removalPolicy || RemovalPolicy.DESTROY;

    this.bucket = this.createBucket();
    this.createConfig(this.bucket);
    this.cloudfrontDistribution = this.createCloudFrontDistribution(this.bucket);

    this.cloudFrontUrl = `https://${this.cloudfrontDistribution.domainName}`;
    this.appUrl = (this.stackProps.domain && `https://${this.stackProps.domain.domainName}`) || this.cloudFrontUrl;
  }
}
