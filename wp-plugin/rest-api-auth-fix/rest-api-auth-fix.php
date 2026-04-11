<?php
/**
 * Plugin Name: REST API Basic Auth Fix
 * Plugin URI: https://github.com/tanukichiyamaguchi/dentalBlog
 * Description: XSERVER等のCGI/FastCGI環境でREST APIのBasic認証(Application Password)を有効にします。
 * Version: 4.0.0
 * Author: Sasaki Dental Blog Tools
 * License: GPL-2.0-or-later
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * クエリパラメータ _wp_auth から認証情報を読み取り、
 * Application Password で直接認証を実行する。
 *
 * $_SERVERに頼らず、プラグイン自身が認証を完結させる。
 */
add_filter( 'determine_current_user', function ( $user_id ) {
    // 既にログイン済みなら何もしない
    if ( $user_id ) {
        return $user_id;
    }

    // _wp_auth クエリパラメータから認証情報を取得
    $auth_base64 = '';

    if ( isset( $_GET['_wp_auth'] ) && ! empty( $_GET['_wp_auth'] ) ) {
        $auth_base64 = $_GET['_wp_auth'];
    } elseif ( isset( $_SERVER['HTTP_X_WP_AUTHORIZATION'] ) && ! empty( $_SERVER['HTTP_X_WP_AUTHORIZATION'] ) ) {
        $val = $_SERVER['HTTP_X_WP_AUTHORIZATION'];
        if ( stripos( $val, 'Basic ' ) === 0 ) {
            $auth_base64 = substr( $val, 6 );
        }
    } elseif ( isset( $_SERVER['HTTP_AUTHORIZATION'] ) && ! empty( $_SERVER['HTTP_AUTHORIZATION'] ) ) {
        $val = $_SERVER['HTTP_AUTHORIZATION'];
        if ( stripos( $val, 'Basic ' ) === 0 ) {
            $auth_base64 = substr( $val, 6 );
        }
    } elseif ( isset( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) && ! empty( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ) {
        $val = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        if ( stripos( $val, 'Basic ' ) === 0 ) {
            $auth_base64 = substr( $val, 6 );
        }
    }

    if ( empty( $auth_base64 ) ) {
        return $user_id;
    }

    $decoded = base64_decode( $auth_base64 );
    if ( ! $decoded || strpos( $decoded, ':' ) === false ) {
        return $user_id;
    }

    list( $username, $password ) = explode( ':', $decoded, 2 );

    // Application Password で直接認証を実行
    if ( function_exists( 'wp_authenticate_application_password' ) ) {
        $user = wp_authenticate_application_password( null, $username, $password );
        if ( ! is_wp_error( $user ) && $user instanceof WP_User ) {
            $_SERVER['PHP_AUTH_USER'] = $username;
            $_SERVER['PHP_AUTH_PW']   = $password;
            return $user->ID;
        }
    }

    // フォールバック: wp_authenticate を使用
    $user = wp_authenticate( $username, $password );
    if ( ! is_wp_error( $user ) && $user instanceof WP_User ) {
        $_SERVER['PHP_AUTH_USER'] = $username;
        $_SERVER['PHP_AUTH_PW']   = $password;
        return $user->ID;
    }

    return $user_id;
}, 15 );

/**
 * REST API エンドポイント登録
 */
add_action( 'rest_api_init', function () {

    // 診断用エンドポイント（認証不要）
    register_rest_route( 'sasaki-dental/v1', '/status', array(
        'methods'             => 'GET',
        'callback'            => function () {
            return new WP_REST_Response( array(
                'plugin'     => 'rest-api-auth-fix',
                'version'    => '4.0.0',
                'active'     => true,
                'php_sapi'   => php_sapi_name(),
                'wp_version' => get_bloginfo( 'version' ),
            ), 200 );
        },
        'permission_callback' => '__return_true',
    ) );

    // デバッグ用エンドポイント（認証不要・環境情報を表示）
    register_rest_route( 'sasaki-dental/v1', '/debug', array(
        'methods'             => 'GET',
        'callback'            => function ( $request ) {
            $wp_auth_present = isset( $_GET['_wp_auth'] ) && ! empty( $_GET['_wp_auth'] );
            $wp_auth_length  = $wp_auth_present ? strlen( $_GET['_wp_auth'] ) : 0;

            // _wp_auth のデコードテスト
            $decode_ok = false;
            $username_found = '';
            if ( $wp_auth_present ) {
                $decoded = base64_decode( $_GET['_wp_auth'] );
                if ( $decoded && strpos( $decoded, ':' ) !== false ) {
                    list( $u, $p ) = explode( ':', $decoded, 2 );
                    $decode_ok = true;
                    $username_found = $u;
                }
            }

            // ユーザー存在チェック
            $user_exists = false;
            if ( $username_found ) {
                $user = get_user_by( 'login', $username_found );
                $user_exists = ! empty( $user );
            }

            // Application Passwords 有効チェック
            $app_pw_available = function_exists( 'wp_is_application_passwords_available' )
                ? wp_is_application_passwords_available()
                : 'function not found';

            // Application Passwords がユーザーに存在するか
            $app_pw_count = 0;
            if ( $user_exists && function_exists( 'WP_Application_Passwords' ) ) {
                $passwords = WP_Application_Passwords::get_user_application_passwords( $user->ID );
                $app_pw_count = is_array( $passwords ) ? count( $passwords ) : 0;
            }

            return new WP_REST_Response( array(
                'wp_auth_param_present'    => $wp_auth_present,
                'wp_auth_param_length'     => $wp_auth_length,
                'base64_decode_ok'         => $decode_ok,
                'username_found'           => $username_found ? substr( $username_found, 0, 3 ) . '***' : '',
                'user_exists_in_wp'        => $user_exists,
                'app_passwords_available'  => $app_pw_available,
                'app_passwords_count'      => $app_pw_count,
                'php_auth_user_set'        => ! empty( $_SERVER['PHP_AUTH_USER'] ),
                'current_user_id'          => get_current_user_id(),
                'server_vars'              => array(
                    'HTTP_AUTHORIZATION'          => isset( $_SERVER['HTTP_AUTHORIZATION'] ) ? 'present' : 'absent',
                    'REDIRECT_HTTP_AUTHORIZATION' => isset( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ? 'present' : 'absent',
                    'HTTP_X_WP_AUTHORIZATION'     => isset( $_SERVER['HTTP_X_WP_AUTHORIZATION'] ) ? 'present' : 'absent',
                ),
            ), 200 );
        },
        'permission_callback' => '__return_true',
    ) );
} );

/**
 * プラグイン有効化時に .htaccess にAuthorizationヘッダー転送ルールを追加する。
 */
register_activation_hook( __FILE__, function () {
    $htaccess = ABSPATH . '.htaccess';
    if ( ! is_writable( $htaccess ) ) {
        return;
    }

    $content = file_get_contents( $htaccess );
    if ( strpos( $content, 'REST API Auth Fix' ) !== false ) {
        return;
    }

    $rule = "\n# BEGIN REST API Auth Fix\n"
          . "<IfModule mod_rewrite.c>\n"
          . "RewriteEngine On\n"
          . "RewriteCond %{HTTP:Authorization} ^(.*)\n"
          . "RewriteRule .* - [E=HTTP_AUTHORIZATION:%1]\n"
          . "</IfModule>\n"
          . "# END REST API Auth Fix\n\n";

    file_put_contents( $htaccess, $rule . $content );
} );

/**
 * プラグイン無効化時に .htaccess から追加したルールを削除する。
 */
register_deactivation_hook( __FILE__, function () {
    $htaccess = ABSPATH . '.htaccess';
    if ( ! is_writable( $htaccess ) ) {
        return;
    }

    $content = file_get_contents( $htaccess );
    $content = preg_replace(
        '/\n?# BEGIN REST API Auth Fix\n.*?# END REST API Auth Fix\n*/s',
        '',
        $content
    );
    file_put_contents( $htaccess, $content );
} );
